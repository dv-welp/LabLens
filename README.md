# LabLens

A mobile interface for navigating and updating my experimental laboratory records stored in Google Sheets.\
Made for my convenience.

I supplement my lab notebook with a spreadsheet to keep track of simultaneous experimental activities like genetic crosses and cloning experiments over a long time. Each column is an experiment; each row is a day. I have other tabs to plan and keep track of various lab activities, including my long-term and daily plans, and my inventories in various refrigerators. This is hosted on Google Sheets so I can refer to it and make entries from my phone.

<p align="center">
  <img width="700" alt="sheet-tabs" src="https://github.com/user-attachments/assets/abc1f7eb-0544-4dc2-8c3f-a53dfc1c70c4" />
</p>

This layout works great on my laptop, and helps me stay sane. But on the Sheets phone app, the cell text box is tiny, older text needs manual cursor scrolling to read, and row/column manipulations are cumbersome at best. I tried to mitigate this inconvenience with LabLens, a small Apps Script web app that reads and writes the same sheet but shows it in a way that works on a phone. The sheet stays the source of truth; LabLens is layered over it to make the interface more user friendly.

Each cell opens into a pop-up, allowing intuitive scrolling. I make my entry in three parts: a log of work that day, a comment if needed, and an instruction on what to do next. Each experiment has a 'next' cell frozen at the top of its column, which automatically pulls the most recent next-step entered in that column, giving me a bird's-eye view of what is to be done.

In addition, something that is very good is the day view. You can shift between the grid and day view, and day view pulls the logs and plans from the Experiments, Freezing and Plan tabs to give an overview of what I'm slated to do on that day.

<p align="center">
  <img width="800" alt="lablens-screens" src="https://github.com/user-attachments/assets/a1756ab1-8d32-4a37-85e0-91bee954801c" />
</p>
