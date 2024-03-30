using Dapper;
using ordermateAPI.DAL.Interfaces;
using ordermateAPI.DAL.Models;
using ordermateAPI.DAL.Scripts;

namespace ordermateAPI.DAL.Repositories;

public class OrderItemRepository : IOrderItemRepository
{
    private readonly IDbContext _dbContext;

    public OrderItemRepository(IDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<OrderItemModel?> Get(int orderItemId)
    {
        using var connection = _dbContext.CreateConnection();
        
        return await connection.QuerySingleOrDefaultAsync<OrderItemModel>(OrderItemScripts.Get, new { orderItemId });
    }

    public async Task<OrderItemModel?> Get(int orderId, int productOptionId, List<ordermateAPI.Models.AddOrderItemModel.OrderItemModifier> modifiers)
    {
        using var connection = _dbContext.CreateConnection();
        
        var orderItems = (await connection.QueryAsync<OrderItemModel>(OrderItemScripts.GetByOrderIdAndProductOptionId, new { orderId, productOptionId })).ToList();

        foreach (var orderItem in orderItems)
        {
            var script = $"SELECT TOP 1 oi.* FROM OrderItems oi INNER JOIN OrderItemModifiers oim on oim.OrderItemId = oi.OrderItemId INNER JOIN Orders o on oi.OrderId = o.OrderId WHERE o.OrderId = @orderId AND oi.ProductOptionId = @productOptionId ";
            foreach (var modifier in modifiers)
            {
                script += $"AND EXISTS (SELECT * FROM OrderItemModifiers oim WHERE oim.ModifierId = {modifier.ModifierId} AND oim.Quantity = {modifier.Quantity})";
            }

            var existingOrderItem = await connection.QuerySingleOrDefaultAsync<OrderItemModel>(script, new { orderId, orderItem.ProductOptionId });
            if (existingOrderItem != null)
                return existingOrderItem;
        }

        return null;
    }

    public async Task<IEnumerable<OrderItemModel>> GetAllOrderItemsByOrderId(int orderId)
    {
        using var connection = _dbContext.CreateConnection();
        
        return await connection.QueryAsync<OrderItemModel>(OrderItemScripts.GetAllByOrderId, new { orderId });
    }

    public async Task AddItem(ordermateAPI.Models.AddOrderItemModel addOrderItem)
    {
        using var connection = _dbContext.CreateConnection();
        
        var orderItemId = await connection.QuerySingleAsync<int>(OrderItemScripts.AddItemToOrder,
            new { addOrderItem.OrderId, addOrderItem.ProductOptionId, addOrderItem.Quantity });

        foreach (var modifier in addOrderItem.Modifiers)
        {
            await connection.ExecuteAsync(OrderItemModifierScripts.AddModifierToOrderItem,
                new { orderItemId, modifier.ModifierId, modifier.Quantity });
        }
    }

    public async Task UpdateItemAndModifiers(ordermateAPI.Models.AddOrderItemModel addOrderItem, List<OrderItemModifierModel> existingModifiers)
    {
        using var connection = _dbContext.CreateConnection();
        
        await connection.ExecuteAsync(OrderItemScripts.UpdateOrderItem,
            new { addOrderItem.OrderItemId, addOrderItem.Quantity });
        
        foreach (var modifier in addOrderItem.Modifiers)
        {
            var orderItemModifier = existingModifiers.SingleOrDefault(x => x.ModifierId == modifier.ModifierId);
            if (orderItemModifier == null)
            {
                await connection.ExecuteAsync(OrderItemModifierScripts.AddModifierToOrderItem,
                    new { addOrderItem.OrderItemId, modifier.ModifierId, modifier.Quantity });
            }
            else
            {
                await connection.ExecuteAsync(OrderItemModifierScripts.UpdateOrderItemModifier,
                    new { addOrderItem.OrderItemId, modifier.Quantity });

                existingModifiers.Remove(orderItemModifier);
            }
        }

        if (existingModifiers.Any())
        {
            foreach (var removedModifier in existingModifiers)
            {
                await RemoveItem(removedModifier.ModifierId);
            }
        }
    }
    public async Task UpdateItem(ordermateAPI.Models.AddOrderItemModel addOrderItem)
    {
        using var connection = _dbContext.CreateConnection();
        
        await connection.ExecuteAsync(OrderItemScripts.UpdateOrderItem,
            new { addOrderItem.Quantity, addOrderItem.OrderItemId });
    }

    public async Task RemoveItem(int orderItemId)
    {
        using var connection = _dbContext.CreateConnection();
        
        await connection.ExecuteAsync(OrderItemScripts.RemoveOrderItemAndModifiers,
            new { orderItemId });
    }
}